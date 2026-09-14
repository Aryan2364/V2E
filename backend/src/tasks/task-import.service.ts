import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { CompletionMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';
import { ChecklistAccessService } from '../task-masters/checklist-access.service';
import { HolidaysService } from '../holidays/holidays.service';
import { LeaveService } from '../leave/leave.service';
import { TasksService } from './tasks.service';
import { ACTIVE_ASSIGNEE } from './active-assignee';
import { CreateTaskDto } from './dto/create-task.dto';
import {
  BulkTaskImportRowDto,
  IMPORT_ASSIGNEE_SLOTS,
  IMPORT_CC_SLOTS,
  IMPORT_ESCALATION_SLOTS,
  TaskImportBatchDetail,
  TaskImportBatchSummary,
  TaskImportOptions,
  TaskImportResolved,
  TaskImportResult,
  TaskImportRowIssue,
  TaskImportRowResult,
  TaskImportValidationResult,
  TaskImportValidationRow,
  TaskUndoImportResult,
  TaskUndoKeptRow,
} from './dto/bulk-import-task.dto';

/** Combined dropdown values read "Value · Context" with this glue (mirrors employee import). */
export const VALUE_SEPARATOR = ' · ';
const UNDO_WINDOW_MINUTES = 30;
const MAX_TITLE = 50;
const MAX_DESCRIPTION = 2000;
const REMINDER_TIME = '09:00';

// The proof file-type groups the picker offers (kept in sync with the frontend's
// FILE_TYPE_GROUPS) — surfaced in import-options for the template's hint row.
const PROOF_EXTENSION_GROUPS = [
  { label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
  { label: 'PDF', extensions: ['pdf'] },
  { label: 'Documents', extensions: ['doc', 'docx', 'txt', 'ppt', 'pptx'] },
  { label: 'Spreadsheets', extensions: ['xls', 'xlsx', 'csv'] },
  { label: 'Video', extensions: ['mp4', 'webm', 'mov'] },
  { label: 'Audio', extensions: ['mp3'] },
  { label: 'Archives', extensions: ['zip'] },
];
const ALLOWED_PROOF_EXTS = new Set(PROOF_EXTENSION_GROUPS.flatMap((g) => g.extensions));

type PersonRef = { user_id: string; label: string };

interface ChecklistTemplateRef {
  id: string;
  name: string;
  items: { title: string; order_index: number }[];
}

interface ExistingTaskRef {
  deadlineDate: string | null; // YYYY-MM-DD
  assignees: Set<string>; // non-CC assignee user ids
}

interface ImportContext {
  priorityByLabel: Map<string, { id: string; label: string }>;
  categoryByName: Map<string, { id: string; name: string }>;
  goalByTitle: Map<string, { id: string; title: string }>;
  checklistByName: Map<string, ChecklistTemplateRef>;
  // Eligible-pool people, resolvable by full "Name · Dept · Role" value or by bare name.
  personByValue: Map<string, PersonRef>;
  personByName: Map<string, PersonRef[]>;
  // Existing open tasks keyed by normalized title — for the duplicate soft-warning.
  existingByTitle: Map<string, ExistingTaskRef[]>;
}

interface PreparedTask {
  index: number;
  rowNum: number;
  title: string;
  dto: CreateTaskDto | null; // built when the row is ready
  resolved: TaskImportResolved;
  issues: TaskImportRowIssue[];
  attachmentNames: string[];
  deadlineDate?: string; // the local YYYY-MM-DD the user typed (for holiday/leave checks)
  assigneeIds: string[]; // resolved non-CC assignee user ids (for holiday/leave checks)
}

@Injectable()
export class TaskImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
    private readonly checklistAccess: ChecklistAccessService,
    private readonly holidays: HolidaysService,
    private readonly leave: LeaveService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasks: TasksService,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Reference data for the template's dropdowns + hint rows (scoped to this actor). */
  async getImportOptions(orgId: string, userId: string): Promise<TaskImportOptions> {
    const [priorities, categories, goals, templates, { pool }, profileMap] = await Promise.all([
      this.prisma.taskPriority.findMany({
        where: { organization_id: orgId, is_active: true },
        orderBy: { order_index: 'asc' },
        select: { id: true, label: true },
      }),
      this.prisma.taskCategory.findMany({
        where: { organization_id: orgId, is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.goal.findMany({
        where: { organization_id: orgId, is_deleted: false },
        orderBy: { title: 'asc' },
        select: { id: true, title: true },
      }),
      this.checklistAccess.listAccessibleTemplates(orgId, userId),
      this.assigneeVisibility.resolve(orgId, userId),
      this.assigneeVisibility.getProfiles(orgId),
    ]);

    const assignees = [...pool]
      .map((id) => profileMap.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        user_id: p.user_id,
        name: p.name,
        department_name: p.department_name ?? null,
        role_title: p.role_title ?? null,
        value: this.personValue(p.name, p.department_name, p.role_title),
      }))
      .sort((a, b) => (a.department_name ?? '').localeCompare(b.department_name ?? '') || a.name.localeCompare(b.name));

    return {
      priorities,
      categories,
      goals: goals.map((g) => ({ id: g.id, title: g.title })),
      checklist_templates: templates.map((t) => ({ id: t.id, name: t.name })),
      assignees,
      proof_extension_groups: PROOF_EXTENSION_GROUPS,
      slots: { assignees: IMPORT_ASSIGNEE_SLOTS, cc: IMPORT_CC_SLOTS, escalations: IMPORT_ESCALATION_SLOTS },
    };
  }

  /** Dry-run: resolve every row's references, flag problems. Writes nothing. */
  async validateImport(orgId: string, userId: string, rows: BulkTaskImportRowDto[]): Promise<TaskImportValidationResult> {
    const ctx = await this.loadContext(orgId, userId);
    const fileSeen = new Map<string, ExistingTaskRef[]>();
    const prepared = rows.map((row, i) => this.evaluate(row, i, ctx, fileSeen));
    await this.enrichHolidayLeaveWarnings(orgId, prepared);
    return this.toValidationResult(prepared);
  }

  /** Commit: re-resolve, then create each ready row through the real createTask path. */
  async commitImport(
    orgId: string,
    userId: string,
    rows: BulkTaskImportRowDto[],
    fileName?: string,
  ): Promise<TaskImportResult> {
    const ctx = await this.loadContext(orgId, userId);
    const fileSeen = new Map<string, ExistingTaskRef[]>();
    const prepared = rows.map((row, i) => this.evaluate(row, i, ctx, fileSeen));

    const results: TaskImportRowResult[] = [];
    // Rows that won't import — surface them up front with their first error.
    for (const p of prepared) {
      if (!p.dto || p.issues.some((iss) => iss.severity === 'error')) {
        results.push({
          row: p.rowNum,
          title: p.title,
          status: 'failed',
          error: p.issues.find((iss) => iss.severity === 'error')?.message ?? 'Row could not be imported',
          attachment_names: p.attachmentNames,
        });
      }
    }

    const ready = prepared.filter((p) => p.dto && !p.issues.some((iss) => iss.severity === 'error'));
    if (ready.length === 0) {
      return { batch_id: null, created: 0, failed: results.length, results: this.sortResults(results) };
    }

    const batch = await this.prisma.taskImportBatch.create({
      data: {
        organization_id: orgId,
        imported_by_user_id: userId,
        file_name: fileName ?? null,
        total_rows: rows.length,
        created_count: 0,
        failed_count: 0,
      },
    });

    let created = 0;
    for (const p of ready) {
      try {
        const task = await this.tasks.createTask(orgId, userId, p.dto!);
        // Stamp the batch onto the task so undo can find (and reverse) it.
        await this.prisma.task.update({ where: { id: task.id }, data: { import_batch_id: batch.id } });
        results.push({
          row: p.rowNum,
          title: p.title,
          status: 'created',
          task_id: task.id,
          attachment_names: p.attachmentNames,
        });
        created++;
      } catch (e) {
        results.push({
          row: p.rowNum,
          title: p.title,
          status: 'failed',
          error: e instanceof Error ? e.message : 'Unknown error',
          attachment_names: p.attachmentNames,
        });
      }
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    await this.prisma.taskImportBatch.update({
      where: { id: batch.id },
      data: { created_count: created, failed_count: failed },
    });

    // Retain every submitted row so the batch can be reopened + re-exported later.
    await this.prisma.taskImportRow.createMany({
      data: results.map((r) => ({
        batch_id: batch.id,
        row_num: r.row,
        title: r.title || null,
        status: r.status,
        error: r.error ?? null,
        payload: (rows[r.row - 2] ?? {}) as Prisma.InputJsonValue,
        created_task_id: r.status === 'created' ? (r.task_id ?? null) : null,
      })),
    });

    return { batch_id: batch.id, created, failed, results: this.sortResults(results) };
  }

  /** Import History — every batch, newest first, with how many tasks still exist + undo eligibility. */
  async listImportBatches(orgId: string): Promise<TaskImportBatchSummary[]> {
    const batches = await this.prisma.taskImportBatch.findMany({
      where: { organization_id: orgId },
      orderBy: { created_at: 'desc' },
      include: {
        imported_by: { select: { name: true } },
        _count: { select: { tasks: { where: { is_deleted: false } } } },
      },
    });
    const cutoff = Date.now() - UNDO_WINDOW_MINUTES * 60_000;
    return batches.map((b) => ({
      id: b.id,
      file_name: b.file_name,
      imported_by: b.imported_by?.name ?? 'Unknown',
      total_rows: b.total_rows,
      created_count: b.created_count,
      failed_count: b.failed_count,
      remaining: b._count.tasks,
      status: b.status,
      can_undo: b.status === 'committed' && b._count.tasks > 0 && b.created_at.getTime() >= cutoff,
      created_at: b.created_at.toISOString(),
      undone_at: b.undone_at ? b.undone_at.toISOString() : null,
    }));
  }

  /** Full detail of one past batch: every stored row + which created tasks still exist. */
  async getImportBatchDetail(orgId: string, batchId: string): Promise<TaskImportBatchDetail> {
    const batch = await this.prisma.taskImportBatch.findFirst({
      where: { id: batchId, organization_id: orgId },
      include: {
        imported_by: { select: { name: true } },
        rows: { orderBy: { row_num: 'asc' } },
        _count: { select: { tasks: { where: { is_deleted: false } } } },
      },
    });
    if (!batch) throw new NotFoundException('Import batch not found');

    // Tasks from this batch that still exist — i.e. NOT removed by a later undo.
    const present = await this.prisma.task.findMany({
      where: { import_batch_id: batchId, organization_id: orgId, is_deleted: false },
      select: { id: true, title: true },
    });
    const presentIds = new Set(present.map((t) => t.id));

    const rows: TaskImportBatchDetail['rows'] =
      batch.rows.length > 0
        ? batch.rows.map((r) => ({
            row: r.row_num,
            title: r.title,
            status: r.status,
            error: r.error,
            still_present: r.status === 'created' && !!r.created_task_id && presentIds.has(r.created_task_id),
            data: (r.payload as Record<string, string>) ?? {},
          }))
        : present.map((t, i) => ({
            row: i + 1,
            title: t.title,
            status: 'created' as const,
            error: null,
            still_present: true,
            data: {},
          }));

    const cutoff = Date.now() - UNDO_WINDOW_MINUTES * 60_000;
    return {
      id: batch.id,
      file_name: batch.file_name,
      imported_by: batch.imported_by?.name ?? 'Unknown',
      total_rows: batch.total_rows,
      created_count: batch.created_count,
      failed_count: batch.failed_count,
      remaining: batch._count.tasks,
      status: batch.status,
      can_undo: batch.status === 'committed' && batch._count.tasks > 0 && batch.created_at.getTime() >= cutoff,
      created_at: batch.created_at.toISOString(),
      undone_at: batch.undone_at ? batch.undone_at.toISOString() : null,
      undo_summary: (batch.undo_summary as TaskImportBatchDetail['undo_summary']) ?? null,
      rows,
      rows_reconstructed: batch.rows.length === 0 && present.length > 0,
    };
  }

  /**
   * Guarded undo: within the window, removes only tasks that are still "clean" —
   * still open in their initial state and untouched (no comments, no status change,
   * no proof, no completion). Any task that has been acted on is kept and reported.
   */
  async undoImport(orgId: string, batchId: string): Promise<TaskUndoImportResult> {
    const batch = await this.prisma.taskImportBatch.findFirst({
      where: { id: batchId, organization_id: orgId },
    });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.status === 'undone') {
      return { batch_id: batchId, undone: 0, kept: [], status: 'undone' };
    }
    if (batch.created_at.getTime() < Date.now() - UNDO_WINDOW_MINUTES * 60_000) {
      // Window elapsed — nothing is removed, but we don't error the UI hard here.
      return { batch_id: batchId, undone: 0, kept: [], status: batch.status as TaskUndoImportResult['status'] };
    }

    const tasks = await this.prisma.task.findMany({
      where: { import_batch_id: batchId, organization_id: orgId, is_deleted: false },
      select: {
        id: true,
        title: true,
        completed_at: true,
        status: { select: { type: true } },
        _count: {
          select: {
            comments: { where: { is_deleted: false } },
            attachments: { where: { is_deleted: false } },
            activity_logs: true,
          },
        },
      },
    });

    const kept: TaskUndoKeptRow[] = [];
    const deletableIds: string[] = [];
    for (const t of tasks) {
      const reasons: string[] = [];
      if (t.completed_at) reasons.push('has been completed');
      if (t.status?.type && t.status.type !== 'not_started') reasons.push('has been worked on (status changed)');
      if (t._count.comments > 0) reasons.push('has comments');
      // Every imported task starts with one "created" activity log; more than that
      // means someone has since acted on it (assigned, status, proof, …).
      if (t._count.activity_logs > 1) reasons.push('has activity');
      if (reasons.length > 0) kept.push({ title: t.title, reason: reasons.join('; ') });
      else deletableIds.push(t.id);
    }

    if (deletableIds.length > 0) {
      // Task children (assignees, checklist, reminders, escalations, comments,
      // attachments, activity logs, views) all cascade on task delete.
      await this.prisma.task.deleteMany({ where: { id: { in: deletableIds }, organization_id: orgId } });
    }

    const remaining = await this.prisma.task.count({
      where: { import_batch_id: batchId, is_deleted: false },
    });
    const status = remaining === 0 ? 'undone' : 'partially_undone';
    await this.prisma.taskImportBatch.update({
      where: { id: batchId },
      data: {
        status,
        undone_at: new Date(),
        undo_summary: { undone: deletableIds.length, kept } as unknown as Prisma.InputJsonValue,
      },
    });

    return { batch_id: batchId, undone: deletableIds.length, kept, status };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private personValue(name: string, dept?: string | null, role?: string | null): string {
    return [name, dept, role].filter((v) => v && v.trim()).join(VALUE_SEPARATOR);
  }

  private async loadContext(orgId: string, userId: string): Promise<ImportContext> {
    const [priorities, categories, goals, templates, { pool }, profileMap, existingTasks] = await Promise.all([
      this.prisma.taskPriority.findMany({ where: { organization_id: orgId, is_active: true }, select: { id: true, label: true } }),
      this.prisma.taskCategory.findMany({ where: { organization_id: orgId, is_active: true }, select: { id: true, name: true } }),
      this.prisma.goal.findMany({ where: { organization_id: orgId, is_deleted: false }, select: { id: true, title: true } }),
      this.checklistAccess.listAccessibleTemplates(orgId, userId),
      this.assigneeVisibility.resolve(orgId, userId),
      this.assigneeVisibility.getProfiles(orgId),
      // Open tasks in this org — to flag likely duplicates (same title + shared assignee).
      this.prisma.task.findMany({
        where: { organization_id: orgId, is_deleted: false },
        // Duplicate detection compares against who HOLDS the task now: someone taken
        // off it no longer has it, so importing it to them isn't a duplicate.
        select: {
          title: true,
          deadline: true,
          assignees: { where: { ...ACTIVE_ASSIGNEE, is_cc: false }, select: { user_id: true } },
        },
      }),
    ]);

    const existingByTitle = new Map<string, ExistingTaskRef[]>();
    for (const t of existingTasks) {
      const key = t.title.trim().toLowerCase();
      const ref: ExistingTaskRef = {
        deadlineDate: t.deadline ? t.deadline.toISOString().slice(0, 10) : null,
        assignees: new Set(t.assignees.map((a) => a.user_id)),
      };
      existingByTitle.set(key, [...(existingByTitle.get(key) ?? []), ref]);
    }

    const priorityByLabel = new Map(priorities.map((p) => [p.label.trim().toLowerCase(), p]));
    const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
    const goalByTitle = new Map(goals.map((g) => [g.title.trim().toLowerCase(), g]));
    const checklistByName = new Map<string, ChecklistTemplateRef>(
      templates.map((t) => {
        const items = Array.isArray(t.items) ? (t.items as any[]) : [];
        const norm = items
          .map((it, i) => ({ title: String(it?.title ?? '').trim(), order_index: Number(it?.order_index ?? i) }))
          .filter((it) => it.title);
        return [t.name.trim().toLowerCase(), { id: t.id, name: t.name, items: norm }];
      }),
    );

    const personByValue = new Map<string, PersonRef>();
    const personByName = new Map<string, PersonRef[]>();
    for (const id of pool) {
      const p = profileMap.get(id);
      if (!p) continue;
      const ref: PersonRef = { user_id: p.user_id, label: p.name };
      const full = this.personValue(p.name, p.department_name, p.role_title).toLowerCase();
      personByValue.set(full, ref);
      // Also register the shorter "name · dept" form for forgiving matches.
      personByValue.set(this.personValue(p.name, p.department_name).toLowerCase(), ref);
      const nk = p.name.trim().toLowerCase();
      personByName.set(nk, [...(personByName.get(nk) ?? []), ref]);
    }

    return { priorityByLabel, categoryByName, goalByTitle, checklistByName, personByValue, personByName, existingByTitle };
  }

  /** Resolve one dropdown person value to a user, or push a field error. */
  private resolvePerson(
    raw: string,
    field: string,
    ctx: ImportContext,
    push: (message: string, field: string, severity?: 'error' | 'warning') => void,
  ): PersonRef | null {
    const v = raw.trim();
    if (!v) return null;
    const lower = v.toLowerCase();
    const byValue = ctx.personByValue.get(lower);
    if (byValue) return byValue;
    // Fall back to a bare-name match (the first cell segment).
    const name = lower.split(VALUE_SEPARATOR)[0].trim();
    const matches = ctx.personByName.get(name);
    if (matches && matches.length === 1) return matches[0];
    if (matches && matches.length > 1) {
      push(`"${v}" matches more than one person — pick the full "Name · Department · Role" value`, field);
      return null;
    }
    push(`"${v}" is not someone you can assign a task to`, field);
    return null;
  }

  /**
   * Pure per-row evaluation. No DB writes; builds a CreateTaskDto when the row is
   * clean. `fileSeen` accumulates title→assignees across the file (mutated in order)
   * so a later row can be flagged as a within-file duplicate of an earlier one.
   */
  private evaluate(
    row: BulkTaskImportRowDto,
    index: number,
    ctx: ImportContext,
    fileSeen: Map<string, ExistingTaskRef[]>,
  ): PreparedTask {
    const issues: TaskImportRowIssue[] = [];
    const push = (message: string, field?: string, severity: 'error' | 'warning' = 'error') =>
      issues.push({ message, field, severity });
    const resolved: TaskImportResolved = {};

    const title = (row.title ?? '').trim();
    if (!title) push('Title is required', 'title');
    else if (title.length > MAX_TITLE) push(`Title must be ${MAX_TITLE} characters or fewer`, 'title');

    const description = (row.description ?? '').trim();
    if (description.length > MAX_DESCRIPTION) push(`Description must be ${MAX_DESCRIPTION} characters or fewer`, 'description');

    // Priority (optional).
    let priorityId: string | undefined;
    const priorityRaw = (row.priority ?? '').trim();
    if (priorityRaw) {
      const p = ctx.priorityByLabel.get(priorityRaw.toLowerCase());
      if (!p) push(`Priority "${priorityRaw}" not found`, 'priority');
      else { priorityId = p.id; resolved.priority = p.label; }
    }

    // Category (optional).
    let categoryId: string | undefined;
    const categoryRaw = (row.category ?? '').trim();
    if (categoryRaw) {
      const c = ctx.categoryByName.get(categoryRaw.toLowerCase());
      if (!c) push(`Category "${categoryRaw}" not found`, 'category');
      else { categoryId = c.id; resolved.category = c.name; }
    }

    // Deadline — required. The frontend precomputes the browser-local ISO instant
    // (deadline_iso); we validate the date parts here and store the instant.
    const deadlineDate = (row.deadline_date ?? '').trim();
    const deadlineTime = (row.deadline_time ?? '').trim() || '23:59';
    let deadlineIso: string | undefined;
    if (!deadlineDate) {
      push('Deadline date is required', 'deadline_date');
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
      push(`Deadline date "${deadlineDate}" must be YYYY-MM-DD`, 'deadline_date');
    } else {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (deadlineDate < todayStr) push('Deadline cannot be in the past', 'deadline_date');
      else if (deadlineDate > '2100-12-31') push('Deadline year cannot exceed 2100', 'deadline_date');
      else if (deadlineTime && !/^\d{2}:\d{2}$/.test(deadlineTime)) push(`Deadline time "${deadlineTime}" must be HH:mm`, 'deadline_time');
      else {
        // Prefer the frontend-computed instant; fall back to a naive parse.
        const iso = (row as any).deadline_iso as string | undefined;
        deadlineIso = iso && !Number.isNaN(Date.parse(iso)) ? iso : new Date(`${deadlineDate}T${deadlineTime}`).toISOString();
        resolved.deadline = `${deadlineDate} ${deadlineTime}`;
      }
    }

    // Assignees (≥1 required) + CC, all from the eligible pool.
    const assigneeIds: string[] = [];
    const assigneeLabels: string[] = [];
    const seen = new Set<string>();
    for (let i = 1; i <= IMPORT_ASSIGNEE_SLOTS; i++) {
      const raw = ((row as any)[`assignee_${i}`] ?? '').trim();
      if (!raw) continue;
      const ref = this.resolvePerson(raw, `assignee_${i}`, ctx, push);
      if (ref && !seen.has(ref.user_id)) { seen.add(ref.user_id); assigneeIds.push(ref.user_id); assigneeLabels.push(ref.label); }
    }
    if (assigneeIds.length === 0 && !issues.some((iss) => iss.field?.startsWith('assignee'))) {
      push('At least one assignee is required', 'assignee_1');
    }
    resolved.assignees = assigneeLabels;

    // Duplicate soft-warning (non-blocking) — same title AND a shared assignee, either
    // with an existing open task or an earlier row in this same file.
    if (title && assigneeIds.length) {
      const key = title.toLowerCase();
      const shares = (refs?: ExistingTaskRef[]) => (refs ?? []).find((e) => assigneeIds.some((id) => e.assignees.has(id)));
      const dupExisting = shares(ctx.existingByTitle.get(key));
      const dupFile = shares(fileSeen.get(key));
      if (dupExisting) {
        const sameDeadline = deadlineDate && dupExisting.deadlineDate === deadlineDate;
        push(`Possible duplicate — a task titled "${title}" is already assigned to one of these people${sameDeadline ? ' with the same deadline' : ''}`, 'title', 'warning');
      } else if (dupFile) {
        push('Possible duplicate — an earlier row in this file has the same title and a shared assignee', 'title', 'warning');
      }
      // Record this row so a later row can detect it as a within-file duplicate.
      fileSeen.set(key, [...(fileSeen.get(key) ?? []), { deadlineDate: deadlineDate || null, assignees: new Set(assigneeIds) }]);
    }

    const ccIds: string[] = [];
    const ccLabels: string[] = [];
    for (let i = 1; i <= IMPORT_CC_SLOTS; i++) {
      const raw = ((row as any)[`cc_${i}`] ?? '').trim();
      if (!raw) continue;
      const ref = this.resolvePerson(raw, `cc_${i}`, ctx, push);
      if (!ref) continue;
      if (seen.has(ref.user_id)) continue; // already an assignee — skip silently
      if (!ccIds.includes(ref.user_id)) { ccIds.push(ref.user_id); ccLabels.push(ref.label); }
    }
    resolved.cc = ccLabels;

    // Completion mode — only meaningful with 2+ assignees; default any_can_complete.
    let completionMode: CompletionMode = CompletionMode.any_can_complete;
    const modeRaw = (row.completion_mode ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (modeRaw) {
      if (modeRaw === 'all_must_complete' || modeRaw === 'all') completionMode = CompletionMode.all_must_complete;
      else if (modeRaw === 'any_can_complete' || modeRaw === 'any') completionMode = CompletionMode.any_can_complete;
      else push('Completion mode must be "any_can_complete" or "all_must_complete"', 'completion_mode');
    }

    // Proof.
    const proofRequired = this.isYes(row.proof_required);
    let proofExts: string[] = [];
    if (proofRequired && (row.proof_allowed_types ?? '').trim()) {
      proofExts = this.splitList(row.proof_allowed_types).map((e) => e.replace(/^\./, '').toLowerCase());
      const bad = proofExts.filter((e) => !ALLOWED_PROOF_EXTS.has(e));
      if (bad.length) push(`Proof file types not allowed: ${bad.join(', ')}`, 'proof_allowed_types', 'warning');
      proofExts = proofExts.filter((e) => ALLOWED_PROOF_EXTS.has(e));
    }

    // Escalation contacts (ordered) — must not overlap assignees.
    const escalationIds: string[] = [];
    const escalationLabels: string[] = [];
    for (let i = 1; i <= IMPORT_ESCALATION_SLOTS; i++) {
      const raw = ((row as any)[`escalation_${i}`] ?? '').trim();
      if (!raw) continue;
      const ref = this.resolvePerson(raw, `escalation_${i}`, ctx, push);
      if (!ref) continue;
      if (seen.has(ref.user_id)) { push(`"${ref.label}" is an assignee and can't also be an escalation contact`, `escalation_${i}`, 'warning'); continue; }
      if (!escalationIds.includes(ref.user_id)) { escalationIds.push(ref.user_id); escalationLabels.push(ref.label); }
    }
    if (escalationLabels.length) resolved.escalations = escalationLabels;

    // Linked goal (optional).
    let goalId: string | undefined;
    const goalRaw = (row.linked_goal ?? '').trim();
    if (goalRaw) {
      const g = ctx.goalByTitle.get(goalRaw.toLowerCase());
      if (!g) push(`Goal "${goalRaw}" not found`, 'linked_goal');
      else { goalId = g.id; resolved.goal = g.title; }
    }

    // Reminder (single "days before"). Blank = no reminder.
    let reminderDays: number | undefined;
    const remRaw = (row.reminder_days_before ?? '').trim();
    if (remRaw) {
      const n = Number(remRaw);
      if (!Number.isInteger(n) || n < 0) push('Reminder days before must be a whole number (0 or more)', 'reminder_days_before');
      else reminderDays = n;
    }

    // Checklist — template (expanded) + ad-hoc items.
    const checklistItems: { title: string; order_index: number; group_title?: string }[] = [];
    const templateIds: string[] = [];
    const templateRaw = (row.checklist_template ?? '').trim();
    if (templateRaw) {
      const tpl = ctx.checklistByName.get(templateRaw.toLowerCase());
      if (!tpl) push(`Checklist template "${templateRaw}" not found or not available to you`, 'checklist_template');
      else {
        templateIds.push(tpl.id);
        resolved.checklist_template = tpl.name;
        const sorted = [...tpl.items].sort((a, b) => a.order_index - b.order_index);
        sorted.forEach((it, i) => checklistItems.push({ title: it.title, order_index: i, group_title: tpl.name }));
      }
    }
    const adhoc = this.splitList(row.checklist_items);
    if (adhoc.length) {
      const base = checklistItems.length;
      const group = checklistItems.length > 0 ? 'Checklist' : undefined; // separate group only when combined with a template
      adhoc.forEach((t, i) => checklistItems.push({ title: t, order_index: base + i, group_title: group }));
    }
    if (checklistItems.length) resolved.checklist_item_count = checklistItems.length;

    // Attachments — filenames matched to uploaded files by the frontend at commit.
    const attachmentNames = this.splitList(row.attachments);
    if (attachmentNames.length) resolved.attachment_names = attachmentNames;

    const hasError = issues.some((iss) => iss.severity === 'error');
    let dto: CreateTaskDto | null = null;
    if (!hasError) {
      dto = {
        title,
        description: description || undefined,
        priority_id: priorityId,
        category_id: categoryId,
        deadline: deadlineIso,
        holiday_override: !this.isNo(row.holiday_override), // import keeps chosen dates by default
        completion_mode: completionMode,
        proof_required: proofRequired,
        proof_allowed_extensions: proofRequired ? proofExts : [],
        assignee_user_ids: assigneeIds,
        cc_user_ids: ccIds,
        escalation_user_ids: escalationIds.length ? escalationIds : undefined,
        goal_id: goalId,
        checklist_items: checklistItems.length ? checklistItems : undefined,
        checklist_template_ids: templateIds.length ? templateIds : undefined,
        reminders:
          reminderDays !== undefined
            ? [{ kind: 'relative', offset_days: reminderDays, time: REMINDER_TIME, recipients: ['assignee'] }]
            : [],
      };
    }

    return {
      index,
      rowNum: index + 2,
      title,
      dto,
      resolved,
      issues,
      attachmentNames,
      deadlineDate: deadlineDate || undefined,
      assigneeIds,
    };
  }

  /**
   * Async enrichment (validate only): flag — as non-blocking warnings — deadlines
   * that land on a company holiday / non-working day, and assignees who are on
   * leave on the deadline. Only ready rows (those that will import) are checked.
   */
  private async enrichHolidayLeaveWarnings(orgId: string, prepared: PreparedTask[]): Promise<void> {
    const ready = prepared.filter((p) => p.dto && p.deadlineDate);
    if (ready.length === 0) return;

    // Holidays — resolve each distinct deadline date once.
    const uniqueDates = [...new Set(ready.map((p) => p.deadlineDate!))].sort();
    const workingByDate = new Map<string, boolean>();
    await Promise.all(
      uniqueDates.map(async (d) => {
        try {
          workingByDate.set(d, await this.holidays.isWorkingDay(new Date(`${d}T12:00:00`), orgId));
        } catch {
          workingByDate.set(d, true); // never fail validation over a holiday lookup
        }
      }),
    );

    // Leave — one availability call across the full deadline span, then range-check.
    const allAssignees = [...new Set(ready.flatMap((p) => p.assigneeIds))];
    const leaveByUser = new Map<string, { start: string; end: string }[]>();
    if (allAssignees.length && uniqueDates.length) {
      try {
        const avail = await this.leave.availability(orgId, allAssignees, uniqueDates[0], uniqueDates[uniqueDates.length - 1]);
        for (const e of avail.results) {
          leaveByUser.set(e.user_id, e.windows.map((w) => ({ start: w.start_date, end: w.end_date })));
        }
      } catch {
        /* leave is advisory — never fail validation over it */
      }
    }

    for (const p of ready) {
      const d = p.deadlineDate!;
      if (workingByDate.get(d) === false) {
        p.issues.push({ message: `Deadline ${d} is a company holiday / non-working day`, field: 'deadline_date', severity: 'warning' });
      }
      const onLeave: string[] = [];
      p.assigneeIds.forEach((id, k) => {
        const windows = leaveByUser.get(id);
        if (windows && windows.some((w) => d >= w.start && d <= w.end)) {
          onLeave.push(p.resolved.assignees?.[k] ?? 'an assignee');
        }
      });
      if (onLeave.length) {
        p.issues.push({ message: `On the deadline ${d}, on leave: ${onLeave.join(', ')}`, field: 'deadline_date', severity: 'warning' });
      }
    }
  }

  // ─── Small parsing helpers ────────────────────────────────────────────────────

  private isYes(raw?: string): boolean {
    const v = (raw ?? '').trim().toLowerCase();
    return v === 'yes' || v === 'y' || v === 'true' || v === '1' || v === 'x' || v === '✓' || v === '✔';
  }

  private isNo(raw?: string): boolean {
    const v = (raw ?? '').trim().toLowerCase();
    return v === 'no' || v === 'n' || v === 'false' || v === '0';
  }

  /** Split a pipe/newline-separated cell into trimmed, non-empty tokens. */
  private splitList(raw?: string): string[] {
    return (raw ?? '')
      .split(/[|\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private toValidationResult(prepared: PreparedTask[]): TaskImportValidationResult {
    const rows: TaskImportValidationRow[] = prepared.map((p) => ({
      row: p.rowNum,
      title: p.title,
      status: p.issues.some((iss) => iss.severity === 'error') ? 'error' : 'ready',
      resolved: p.resolved,
      issues: p.issues,
    }));
    return {
      total: rows.length,
      ready: rows.filter((r) => r.status === 'ready').length,
      errors: rows.filter((r) => r.status === 'error').length,
      warnings: rows.filter((r) => r.status === 'ready' && r.issues.some((iss) => iss.severity === 'warning')).length,
      rows,
    };
  }

  private sortResults(results: TaskImportRowResult[]): TaskImportRowResult[] {
    return [...results].sort((a, b) => a.row - b.row);
  }
}
