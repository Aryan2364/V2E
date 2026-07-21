import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  CompletionType,
  LearningPathStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { CreateLearningPathDto } from './dto/create-learning-path.dto';
import { UpdateLearningPathDto } from './dto/update-learning-path.dto';
import { CreateLearningItemDto } from './dto/create-learning-item.dto';
import { UpdateLearningItemDto } from './dto/update-learning-item.dto';
import { AssignPathDto } from './dto/assign-path.dto';
import { CompleteItemDto } from './dto/complete-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';

const PATH_INCLUDE = {
  items: {
    orderBy: { order_index: 'asc' as const },
  },
  _count: {
    select: { items: true, assignments: true },
  },
};

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  /**
   * Best-effort purge of the R2 objects backing a set of items (the original file
   * plus any converted preview PDF). Deleting the DB row alone would orphan these
   * bytes in the bucket — the only other place they're cleaned up is a file replace
   * in LearningFilesService.uploadItemFile.
   */
  private async purgeItemObjects(
    items: { storage_key: string | null; preview_storage_key: string | null }[],
  ) {
    const keys = items.flatMap((i) =>
      [i.storage_key, i.preview_storage_key].filter((k): k is string => !!k),
    );
    // deleteObject already swallows errors (best-effort), so one missing object
    // never blocks the DB delete.
    await Promise.all(keys.map((k) => this.r2.deleteObject(k)));
  }

  // ─── Paths ──────────────────────────────────────────────────────────────────

  async findAllPaths(orgId: string) {
    return this.prisma.learningPath.findMany({
      where: { organization_id: orgId },
      include: PATH_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOnePath(pathId: string, orgId: string) {
    const path = await this.prisma.learningPath.findFirst({
      where: { id: pathId, organization_id: orgId },
      include: PATH_INCLUDE,
    });
    if (!path) throw new NotFoundException(`Learning path ${pathId} not found`);
    return path;
  }

  async createPath(orgId: string, userId: string, dto: CreateLearningPathDto) {
    return this.prisma.learningPath.create({
      data: {
        ...dto,
        organization_id: orgId,
        created_by_user_id: userId,
      },
      include: PATH_INCLUDE,
    });
  }

  async updatePath(pathId: string, orgId: string, dto: UpdateLearningPathDto) {
    await this.findOnePath(pathId, orgId);
    return this.prisma.learningPath.update({
      where: { id: pathId },
      data: dto,
      include: PATH_INCLUDE,
    });
  }

  async publishPath(pathId: string, orgId: string, actorUserId: string) {
    const path = await this.findOnePath(pathId, orgId);
    if (path.status === LearningPathStatus.published) {
      throw new BadRequestException('Path is already published');
    }

    const updated = await this.prisma.learningPath.update({
      where: { id: pathId },
      data: { status: LearningPathStatus.published },
      include: PATH_INCLUDE,
    });

    // Auto-assign to all active employees with the matching role_id
    if (path.role_id) {
      const employees = await this.prisma.employeeProfile.findMany({
        where: {
          organization_id: orgId,
          role_id: path.role_id,
          status: 'active',
        },
      });

      const employeeIds = employees.map((e) => e.id);
      await this.bulkAssign(pathId, orgId, actorUserId, employeeIds, undefined);
    }

    return updated;
  }

  async archivePath(pathId: string, orgId: string) {
    await this.findOnePath(pathId, orgId);
    return this.prisma.learningPath.update({
      where: { id: pathId },
      data: { status: LearningPathStatus.archived },
      include: PATH_INCLUDE,
    });
  }

  /** Restore an archived path back to published (does not re-run role auto-assignment). */
  async unarchivePath(pathId: string, orgId: string) {
    await this.findOnePath(pathId, orgId);
    return this.prisma.learningPath.update({
      where: { id: pathId },
      data: { status: LearningPathStatus.published },
      include: PATH_INCLUDE,
    });
  }

  async deletePath(pathId: string, orgId: string) {
    await this.findOnePath(pathId, orgId);
    // Collect the file objects of every item under this path before the DB cascade
    // (onDelete: Cascade) wipes the rows, then purge them from R2.
    const items = await this.prisma.learningItem.findMany({
      where: { path_id: pathId },
      select: { storage_key: true, preview_storage_key: true },
    });
    const deleted = await this.prisma.learningPath.delete({ where: { id: pathId } });
    await this.purgeItemObjects(items);
    return deleted;
  }

  // ─── Items ──────────────────────────────────────────────────────────────────

  async addItem(pathId: string, orgId: string, dto: CreateLearningItemDto) {
    await this.findOnePath(pathId, orgId);

    const maxOrder = await this.prisma.learningItem.aggregate({
      where: { path_id: pathId },
      _max: { order_index: true },
    });

    const order_index = dto.order_index ?? (maxOrder._max.order_index ?? -1) + 1;

    return this.prisma.learningItem.create({
      data: { ...dto, path_id: pathId, order_index },
    });
  }

  async updateItem(
    pathId: string,
    itemId: string,
    orgId: string,
    dto: UpdateLearningItemDto,
  ) {
    await this.findOnePath(pathId, orgId);
    const item = await this.prisma.learningItem.findFirst({
      where: { id: itemId, path_id: pathId },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);

    return this.prisma.learningItem.update({ where: { id: itemId }, data: dto });
  }

  async deleteItem(pathId: string, itemId: string, orgId: string) {
    await this.findOnePath(pathId, orgId);
    const item = await this.prisma.learningItem.findFirst({
      where: { id: itemId, path_id: pathId },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} not found`);
    const deleted = await this.prisma.learningItem.delete({ where: { id: itemId } });
    // Purge the file + preview objects so deleting a material also frees the R2 bytes.
    await this.purgeItemObjects([item]);
    return deleted;
  }

  async reorderItems(pathId: string, orgId: string, dto: ReorderItemsDto) {
    await this.findOnePath(pathId, orgId);
    // updateMany scoped to path_id — an id from another path/tenant simply matches
    // nothing and is skipped (no cross-path order_index writes).
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.learningItem.updateMany({
          where: { id: item.id, path_id: pathId },
          data: { order_index: item.order_index },
        }),
      ),
    );
    return { success: true };
  }

  // ─── Assignments ─────────────────────────────────────────────────────────────

  async assignPath(
    pathId: string,
    orgId: string,
    actorUserId: string,
    dto: AssignPathDto,
  ) {
    await this.findOnePath(pathId, orgId);
    const dueDate = dto.due_date ? new Date(dto.due_date) : undefined;
    const assigned = await this.bulkAssign(
      pathId,
      orgId,
      actorUserId,
      dto.employee_profile_ids,
      dueDate,
    );
    return { assigned };
  }

  /**
   * Assign a path to employees. Returns how many NEW assignments were created.
   * SECURITY: only real, active employees of `orgId` are ever assigned — any id that
   * isn't an active member of this org (cross-tenant, deleted, or garbage) is silently
   * dropped, so this can never bind another tenant's employee to our course.
   */
  private async bulkAssign(
    pathId: string,
    orgId: string,
    actorUserId: string,
    employeeProfileIds: string[],
    dueDate?: Date,
  ): Promise<number> {
    const valid = await this.prisma.employeeProfile.findMany({
      where: { id: { in: employeeProfileIds }, organization_id: orgId, status: 'active' },
      select: { id: true },
    });
    const validIds = valid.map((e) => e.id);
    if (validIds.length === 0) return 0;

    // Drop anyone already assigned — one query, not a per-employee round-trip.
    const existing = await this.prisma.learningPathAssignment.findMany({
      where: { path_id: pathId, employee_profile_id: { in: validIds } },
      select: { employee_profile_id: true },
    });
    const already = new Set(existing.map((e) => e.employee_profile_id));
    const toAssign = validIds.filter((id) => !already.has(id));
    if (toAssign.length === 0) return 0;

    const items = await this.prisma.learningItem.findMany({
      where: { path_id: pathId },
      select: { id: true },
    });
    const itemIds = items.map((i) => i.id);

    // Batched writes; skipDuplicates absorbs concurrent-assign races (M4).
    await this.prisma.learningPathAssignment.createMany({
      data: toAssign.map((empId) => ({
        path_id: pathId,
        employee_profile_id: empId,
        assigned_by_user_id: actorUserId,
        due_date: dueDate,
      })),
      skipDuplicates: true,
    });

    const created = await this.prisma.learningPathAssignment.findMany({
      where: { path_id: pathId, employee_profile_id: { in: toAssign } },
      select: { id: true, employee_profile_id: true },
    });

    if (itemIds.length > 0) {
      await this.prisma.learningItemProgress.createMany({
        data: created.flatMap((a) =>
          itemIds.map((itemId) => ({
            assignment_id: a.id,
            item_id: itemId,
            employee_profile_id: a.employee_profile_id,
          })),
        ),
        skipDuplicates: true,
      });
    }

    await this.prisma.learningPathProgress.createMany({
      data: created.map((a) => ({
        assignment_id: a.id,
        employee_profile_id: a.employee_profile_id,
        path_id: pathId,
        total_items: itemIds.length,
        completed_items: 0,
        progress_percent: 0,
      })),
      skipDuplicates: true,
    });

    return created.length;
  }

  async getAssignments(pathId: string, orgId: string) {
    await this.findOnePath(pathId, orgId);
    return this.prisma.learningPathAssignment.findMany({
      where: { path_id: pathId },
      include: {
        employee_profile: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            role: { select: { id: true, title: true } },
            department: { select: { id: true, name: true } },
          },
        },
        path_progress: true,
      },
      orderBy: { assigned_at: 'desc' },
    });
  }

  // ─── Employee: My Learning ──────────────────────────────────────────────────

  async getMyAssignments(employeeProfileId: string) {
    return this.prisma.learningPathAssignment.findMany({
      where: { employee_profile_id: employeeProfileId },
      include: {
        path: {
          include: { _count: { select: { items: true } } },
        },
        path_progress: true,
      },
      orderBy: { assigned_at: 'desc' },
    });
  }

  async getMyAssignment(assignmentId: string, employeeProfileId: string, orgId: string) {
    const assignment = await this.prisma.learningPathAssignment.findFirst({
      // SECURITY: scope by the path's org too — a cross-tenant assignment row must
      // never resolve for a learner acting in another org.
      where: { id: assignmentId, employee_profile_id: employeeProfileId, path: { organization_id: orgId } },
      include: {
        path: true,
        path_progress: true,
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const items = await this.prisma.learningItem.findMany({
      where: { path_id: assignment.path_id },
      orderBy: { order_index: 'asc' },
    });

    const progresses = await this.prisma.learningItemProgress.findMany({
      where: { assignment_id: assignmentId },
    });

    const progressMap = new Map(progresses.map((p) => [p.item_id, p]));
    const isSequential = assignment.path.mode === 'sequential';

    const itemsWithStatus = items.map((item, idx) => {
      const prog = progressMap.get(item.id);
      let is_locked = false;
      if (isSequential && idx > 0) {
        const prevItem = items[idx - 1];
        const prevProg = progressMap.get(prevItem.id);
        is_locked = !prevProg || prevProg.status !== 'completed';
      }
      return { ...item, is_locked, progress: prog ?? null };
    });

    return { ...assignment, items: itemsWithStatus };
  }

  async completeItem(
    assignmentId: string,
    itemId: string,
    employeeProfileId: string,
    orgId: string,
    dto: CompleteItemDto,
  ) {
    const assignment = await this.prisma.learningPathAssignment.findFirst({
      where: { id: assignmentId, employee_profile_id: employeeProfileId, path: { organization_id: orgId } },
      include: { path: { select: { mode: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    // The item MUST belong to this assignment's path — never fabricate a progress row
    // against an arbitrary (possibly cross-tenant) item id.
    const pathItems = await this.prisma.learningItem.findMany({
      where: { path_id: assignment.path_id },
      orderBy: { order_index: 'asc' },
      select: { id: true },
    });
    const idx = pathItems.findIndex((i) => i.id === itemId);
    if (idx === -1) throw new NotFoundException('Item not found in this course');

    // Sequential mode: can't complete an item until the previous one is completed (M5).
    if (assignment.path.mode === 'sequential' && idx > 0) {
      const prev = await this.prisma.learningItemProgress.findUnique({
        where: { assignment_id_item_id: { assignment_id: assignmentId, item_id: pathItems[idx - 1].id } },
      });
      if (!prev || prev.status !== AssignmentStatus.completed) {
        throw new BadRequestException('Complete the previous item first.');
      }
    }

    const now = new Date();

    const progress = await this.prisma.learningItemProgress.upsert({
      where: { assignment_id_item_id: { assignment_id: assignmentId, item_id: itemId } },
      update: {
        status: AssignmentStatus.completed,
        completion_type: dto.completion_type as CompletionType,
        completed_at: now,
      },
      create: {
        assignment_id: assignmentId,
        item_id: itemId,
        employee_profile_id: employeeProfileId,
        status: AssignmentStatus.completed,
        completion_type: dto.completion_type as CompletionType,
        started_at: now,
        completed_at: now,
      },
    });

    await this.recalculateProgress(assignmentId, employeeProfileId);

    return progress;
  }

  /** Revert a completed item back to not-started (undo an accidental completion). */
  async uncompleteItem(
    assignmentId: string,
    itemId: string,
    employeeProfileId: string,
    orgId: string,
  ) {
    const assignment = await this.prisma.learningPathAssignment.findFirst({
      where: { id: assignmentId, employee_profile_id: employeeProfileId, path: { organization_id: orgId } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    await this.prisma.learningItemProgress.updateMany({
      where: { assignment_id: assignmentId, item_id: itemId },
      data: {
        status: AssignmentStatus.not_started,
        completion_type: null,
        completed_at: null,
      },
    });

    await this.recalculateProgress(assignmentId, employeeProfileId);
    return { success: true };
  }

  private async recalculateProgress(
    assignmentId: string,
    employeeProfileId: string,
  ) {
    const [total, completed] = await Promise.all([
      this.prisma.learningItemProgress.count({ where: { assignment_id: assignmentId } }),
      this.prisma.learningItemProgress.count({
        where: { assignment_id: assignmentId, status: AssignmentStatus.completed },
      }),
    ]);

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    await this.prisma.learningPathProgress.update({
      where: { assignment_id: assignmentId },
      data: {
        completed_items: completed,
        total_items: total,
        progress_percent: percent,
        last_activity_at: new Date(),
      },
    });

    if (percent === 100) {
      await this.prisma.learningPathAssignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.completed,
          completed_at: new Date(),
        },
      });
    } else {
      // Below 100% — reflect in-progress (or not-started if nothing is done) and
      // clear any prior completion timestamp so an undo properly re-opens the path.
      await this.prisma.learningPathAssignment.update({
        where: { id: assignmentId },
        data: {
          status: completed > 0 ? AssignmentStatus.in_progress : AssignmentStatus.not_started,
          completed_at: null,
        },
      });
    }
  }

  // ─── Progress Dashboard ──────────────────────────────────────────────────────

  async getOrgProgress(orgId: string) {
    const paths = await this.prisma.learningPath.findMany({
      where: { organization_id: orgId },
      include: {
        assignments: {
          include: { path_progress: true },
        },
      },
    });

    let totalAssignments = 0;
    let completedAssignments = 0;
    let inProgressAssignments = 0;
    let notStartedAssignments = 0;
    let sumPercent = 0;

    const pathSummaries = paths.map((path) => {
      const assignments = path.assignments;
      totalAssignments += assignments.length;

      let pCompleted = 0;
      let pInProgress = 0;
      let pNotStarted = 0;
      let pSumPercent = 0;

      for (const a of assignments) {
        if (a.status === 'completed') { pCompleted++; completedAssignments++; }
        else if (a.status === 'in_progress') { pInProgress++; inProgressAssignments++; }
        else { pNotStarted++; notStartedAssignments++; }
        pSumPercent += a.path_progress?.progress_percent ?? 0;
        sumPercent += a.path_progress?.progress_percent ?? 0;
      }

      return {
        path_id: path.id,
        title: path.title,
        status: path.status,
        total_assignments: assignments.length,
        completed: pCompleted,
        in_progress: pInProgress,
        not_started: pNotStarted,
        avg_percent:
          assignments.length > 0
            ? Math.round(pSumPercent / assignments.length)
            : 0,
      };
    });

    return {
      total_paths: paths.length,
      total_assignments: totalAssignments,
      completed_assignments: completedAssignments,
      in_progress_assignments: inProgressAssignments,
      not_started_assignments: notStartedAssignments,
      avg_progress_percent:
        totalAssignments > 0 ? Math.round(sumPercent / totalAssignments) : 0,
      paths: pathSummaries,
    };
  }

  // ─── Auto-assign on employee creation ─────────────────────────────────────

  async autoAssignForNewEmployee(
    employeeProfileId: string,
    roleId: string,
    orgId: string,
    assignedByUserId: string,
  ) {
    const publishedPaths = await this.prisma.learningPath.findMany({
      where: {
        organization_id: orgId,
        status: LearningPathStatus.published,
        role_id: roleId,
      },
    });

    for (const path of publishedPaths) {
      await this.bulkAssign(path.id, orgId, assignedByUserId, [employeeProfileId], undefined);
    }
  }
}
