import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BulkImportChecklistRowDto,
  ChecklistImportBatchSummary,
  ChecklistImportGroup,
  ChecklistImportResult,
  ChecklistImportRow,
  ChecklistImportRowIssue,
  ChecklistImportValidationResult,
  ChecklistUndoImportResult,
} from './dto/bulk-import-checklist.dto';

interface PreparedRow {
  row: number;
  name: string;
  item: string;
  nameKey: string;
  issues: ChecklistImportRowIssue[];
  status: 'ready' | 'error';
}

/**
 * Bulk import of checklist templates from a spreadsheet. The frontend parses the
 * file (one row per checklist item, grouped by a "Checklist Name" column) and
 * sends JSON rows here. Imported templates are created INACTIVE so an admin can
 * set "who can use this" before activating. Mirrors the employee-import pattern
 * (validate → commit → history → guarded undo).
 */
@Injectable()
export class ChecklistImportService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Validate (dry-run) ───────────────────────────────────────────────────────

  async validateImport(orgId: string, rows: BulkImportChecklistRowDto[]): Promise<ChecklistImportValidationResult> {
    const existing = await this.prisma.taskChecklistTemplate.findMany({
      where: { organization_id: orgId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((t) => t.name.trim().toLowerCase()));
    const { prepared, groups } = this.evaluate(rows, existingNames);
    return this.toResult(prepared, groups);
  }

  // ─── Commit ───────────────────────────────────────────────────────────────────

  async commitImport(
    orgId: string,
    userId: string,
    rows: BulkImportChecklistRowDto[],
    fileName?: string,
  ): Promise<ChecklistImportResult> {
    const existing = await this.prisma.taskChecklistTemplate.findMany({
      where: { organization_id: orgId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((t) => t.name.trim().toLowerCase()));
    const { groups } = this.evaluate(rows, existingNames);

    // Only groups that resolved to at least one item are creatable.
    const creatable = groups.filter((g) => g.items.length > 0);
    if (creatable.length === 0) {
      return { batch_id: null, created: 0, failed: groups.length, results: groups.map((g) => ({ name: g.name, item_count: g.items.length, status: 'failed' as const, error: 'No valid items' })) };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.checklistTemplateImportBatch.create({
        data: {
          organization_id: orgId,
          imported_by_user_id: userId,
          file_name: fileName ?? null,
          total_rows: groups.length,
          created_count: 0,
          failed_count: 0,
        },
      });

      const results: ChecklistImportResult['results'] = [];
      let created = 0;
      let failed = 0;
      for (const g of groups) {
        if (g.items.length === 0) {
          failed += 1;
          results.push({ name: g.name, item_count: 0, status: 'failed', error: 'No valid items' });
          continue;
        }
        try {
          await tx.taskChecklistTemplate.create({
            data: {
              organization_id: orgId,
              created_by_user_id: userId,
              name: g.name,
              items: g.items.map((title, i) => ({ title, order_index: i })) as any,
              access_mode: 'everyone',
              is_active: false, // imported templates start inactive
              import_batch_id: batch.id,
            },
          });
          created += 1;
          results.push({ name: g.name, item_count: g.items.length, status: 'created' });
        } catch (e: any) {
          failed += 1;
          results.push({ name: g.name, item_count: g.items.length, status: 'failed', error: e?.message ?? 'Create failed' });
        }
      }

      await tx.checklistTemplateImportBatch.update({
        where: { id: batch.id },
        data: { created_count: created, failed_count: failed },
      });

      return { batch_id: batch.id, created, failed, results };
    });

    return result;
  }

  // ─── History ──────────────────────────────────────────────────────────────────

  async listImportBatches(orgId: string): Promise<ChecklistImportBatchSummary[]> {
    const batches = await this.prisma.checklistTemplateImportBatch.findMany({
      where: { organization_id: orgId },
      orderBy: { created_at: 'desc' },
    });
    if (batches.length === 0) return [];

    const batchIds = batches.map((b) => b.id);
    const templates = await this.prisma.taskChecklistTemplate.findMany({
      where: { organization_id: orgId, import_batch_id: { in: batchIds } },
      select: { import_batch_id: true, is_active: true },
    });
    const presentByBatch = new Map<string, number>();
    const inactiveByBatch = new Map<string, number>();
    for (const t of templates) {
      const id = t.import_batch_id!;
      presentByBatch.set(id, (presentByBatch.get(id) ?? 0) + 1);
      if (!t.is_active) inactiveByBatch.set(id, (inactiveByBatch.get(id) ?? 0) + 1);
    }

    const userIds = [...new Set(batches.map((b) => b.imported_by_user_id))];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return batches.map((b) => {
      const remaining = presentByBatch.get(b.id) ?? 0;
      const undoable = inactiveByBatch.get(b.id) ?? 0;
      return {
        id: b.id,
        file_name: b.file_name,
        imported_by: nameById.get(b.imported_by_user_id) ?? 'Unknown',
        total_rows: b.total_rows,
        created_count: b.created_count,
        failed_count: b.failed_count,
        remaining,
        status: b.status as ChecklistImportBatchSummary['status'],
        can_undo: b.status === 'committed' && undoable > 0,
        created_at: b.created_at.toISOString(),
        undone_at: b.undone_at ? b.undone_at.toISOString() : null,
      };
    });
  }

  // ─── Undo (guarded) ───────────────────────────────────────────────────────────

  async undoImport(orgId: string, batchId: string): Promise<ChecklistUndoImportResult> {
    const batch = await this.prisma.checklistTemplateImportBatch.findFirst({
      where: { id: batchId, organization_id: orgId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');

    const templates = await this.prisma.taskChecklistTemplate.findMany({
      where: { organization_id: orgId, import_batch_id: batchId },
      select: { id: true, name: true, is_active: true },
    });

    // Keep templates the user has since activated; delete the still-inactive ones.
    const toDelete = templates.filter((t) => !t.is_active);
    const kept = templates.filter((t) => t.is_active).map((t) => ({ name: t.name, reason: 'Activated — kept' }));

    if (toDelete.length > 0) {
      await this.prisma.taskChecklistTemplate.deleteMany({ where: { id: { in: toDelete.map((t) => t.id) } } });
    }

    const status: ChecklistUndoImportResult['status'] = kept.length > 0 ? 'partially_undone' : 'undone';
    await this.prisma.checklistTemplateImportBatch.update({
      where: { id: batchId },
      data: { status, undone_at: new Date(), undo_summary: { undone: toDelete.length, kept } as any },
    });

    return { batch_id: batchId, undone: toDelete.length, kept, status };
  }

  // ─── Internal: row evaluation + grouping ──────────────────────────────────────

  private evaluate(
    rows: BulkImportChecklistRowDto[],
    existingNames: Set<string>,
  ): { prepared: PreparedRow[]; groups: ChecklistImportGroup[] } {
    const prepared: PreparedRow[] = [];
    rows.forEach((raw, i) => {
      const name = (raw.checklist_name ?? '').trim();
      const item = (raw.item ?? '').trim();
      if (!name && !item) return; // skip fully blank row
      const issues: ChecklistImportRowIssue[] = [];
      if (!name) issues.push({ field: 'checklist_name', message: 'Checklist name is required.', severity: 'error' });
      if (!item) issues.push({ field: 'item', message: 'Item is required.', severity: 'error' });
      const status: 'ready' | 'error' = issues.some((x) => x.severity === 'error') ? 'error' : 'ready';
      prepared.push({ row: i + 2, name, item, nameKey: name.toLowerCase(), issues, status });
    });

    // Group by checklist name (only rows that have a name), preserving first-seen order.
    const order: string[] = [];
    const byKey = new Map<string, PreparedRow[]>();
    for (const p of prepared) {
      if (!p.name) continue;
      if (!byKey.has(p.nameKey)) {
        byKey.set(p.nameKey, []);
        order.push(p.nameKey);
      }
      byKey.get(p.nameKey)!.push(p);
    }

    const groups: ChecklistImportGroup[] = [];
    for (const key of order) {
      const groupRows = byKey.get(key)!;
      const displayName = groupRows[0].name;
      const alreadyExists = existingNames.has(key);
      if (alreadyExists) {
        groupRows[0].issues.push({
          field: 'checklist_name',
          message: 'A checklist with this name already exists; a new one will be created.',
          severity: 'warning',
        });
      }
      const items: string[] = [];
      const seenItems = new Set<string>();
      for (const r of groupRows) {
        if (r.status !== 'ready') continue;
        const itemKey = r.item.toLowerCase();
        if (seenItems.has(itemKey)) {
          r.issues.push({ field: 'item', message: 'Duplicate item in this checklist — will be skipped.', severity: 'warning' });
          continue;
        }
        seenItems.add(itemKey);
        items.push(r.item);
      }
      groups.push({ name: displayName, items, already_exists: alreadyExists });
    }

    return { prepared, groups };
  }

  private toResult(prepared: PreparedRow[], groups: ChecklistImportGroup[]): ChecklistImportValidationResult {
    const rows: ChecklistImportRow[] = prepared.map((p) => ({
      row: p.row,
      checklist_name: p.name,
      item: p.item,
      status: p.status,
      issues: p.issues,
    }));
    return {
      total: prepared.length,
      ready: prepared.filter((p) => p.status === 'ready').length,
      errors: prepared.filter((p) => p.status === 'error').length,
      warnings: prepared.filter((p) => p.issues.some((x) => x.severity === 'warning')).length,
      templates: groups.filter((g) => g.items.length > 0).length,
      rows,
      groups,
    };
  }
}
