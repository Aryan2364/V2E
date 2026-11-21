import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
  ) {}

  async findAll(orgId: string) {
    return this.prisma.department.findMany({
      where: { organization_id: orgId },
      include: {
        head_user: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: {
            child_departments: true,
            roles: true,
            employee_profiles: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(id: string, orgId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, organization_id: orgId },
      include: {
        head_user: {
          select: { id: true, name: true, email: true },
        },
        parent_department: {
          select: { id: true, name: true },
        },
        _count: {
          select: {
            child_departments: true,
            roles: true,
            employee_profiles: true,
          },
        },
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found in this organization');
    }

    return department;
  }

  async create(orgId: string, dto: CreateDepartmentDto) {
    const created = await this.prisma.department.create({
      data: {
        ...dto,
        organization_id: orgId,
      },
      include: {
        head_user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    this.assigneeVisibility.invalidate(orgId);
    return created;
  }

  async update(id: string, orgId: string, dto: UpdateDepartmentDto) {
    await this.findOne(id, orgId);

    // Canvas position is owned exclusively by the dedicated `:id/position`
    // endpoint. Strip it here so an ordinary edit (name/parent/head/…) can
    // never clobber the node's placement — the DTO carries position defaults
    // that would otherwise reset it to (0, 0) on every save.
    const { position_x: _px, position_y: _py, ...data } = dto;

    const updated = await this.prisma.department.update({
      where: { id },
      data,
      include: {
        head_user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    // head_user / parent / upward-switch changes affect picker pools.
    this.assigneeVisibility.invalidate(orgId);
    return updated;
  }

  async updatePosition(id: string, orgId: string, x: number, y: number) {
    await this.findOne(id, orgId);

    return this.prisma.department.update({
      where: { id },
      data: { position_x: x, position_y: y },
      select: {
        id: true,
        position_x: true,
        position_y: true,
        updated_at: true,
      },
    });
  }

  async remove(id: string, orgId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, organization_id: orgId },
      include: {
        _count: {
          select: {
            child_departments: true,
            employee_profiles: true,
            roles: true,
          },
        },
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found in this organization');
    }

    if (department._count.child_departments > 0) {
      throw new BadRequestException(
        'Cannot delete department that has child departments. Reassign or delete children first.',
      );
    }

    if (department._count.employee_profiles > 0) {
      throw new BadRequestException(
        'Cannot delete department that has employees. Reassign employees first.',
      );
    }

    // Job roles carry a required department FK, so a raw delete would hit a
    // constraint error — block it up front with a clear, actionable message.
    if (department._count.roles > 0) {
      throw new BadRequestException(
        'Cannot delete department that has job roles. Move or delete its roles first.',
      );
    }

    // Clean up assignee-visibility rows that reference this department (no FK cascade
    // on these plain-id columns).
    await this.prisma.assigneeCrossDeptBridge.deleteMany({
      where: { organization_id: orgId, OR: [{ from_department_id: id }, { to_department_id: id }] },
    });

    await this.prisma.department.delete({ where: { id } });

    this.assigneeVisibility.invalidate(orgId);
    return { message: 'Department deleted successfully' };
  }

  async listImportBatches(orgId: string) {
    const batches = await this.prisma.departmentImportBatch.findMany({
      where: { organization_id: orgId },
      include: {
        imported_by: {
          select: { name: true },
        },
        departments: {
          select: {
            id: true,
            _count: {
              select: {
                child_departments: true,
                employee_profiles: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return batches.map((b) => {
      const hasDependents = b.departments.some(
        (d) => d._count.child_departments > 0 || d._count.employee_profiles > 0,
      );
      return {
        id: b.id,
        file_name: b.file_name,
        status: b.status,
        total_rows: b.total_rows,
        created_count: b.created_count,
        failed_count: b.failed_count,
        created_at: b.created_at,
        undone_at: b.undone_at,
        imported_by: b.imported_by.name,
        remaining: b.status === 'committed' ? b.departments.length : 0,
        can_undo: b.status === 'committed' && !hasDependents,
      };
    });
  }

  async createImportBatch(
    orgId: string,
    userId: string,
    dto: { file_name?: string; total_rows: number; created_count: number; failed_count: number; department_ids: string[] },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.departmentImportBatch.create({
        data: {
          organization_id: orgId,
          imported_by_user_id: userId,
          file_name: dto.file_name ?? null,
          total_rows: dto.total_rows,
          created_count: dto.created_count,
          failed_count: dto.failed_count,
        },
      });

      if (dto.department_ids.length > 0) {
        await tx.department.updateMany({
          where: { id: { in: dto.department_ids }, organization_id: orgId },
          data: { import_batch_id: batch.id },
        });
      }

      return batch;
    });
  }

  async undoImport(orgId: string, batchId: string) {
    const batch = await this.prisma.departmentImportBatch.findFirst({
      where: { id: batchId, organization_id: orgId },
      include: {
        departments: {
          include: {
            _count: {
              select: {
                child_departments: true,
                employee_profiles: true,
              },
            },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }

    if (batch.status !== 'committed') {
      throw new BadRequestException(`Import batch has already been ${batch.status}`);
    }

    const blocked = batch.departments.filter(
      (d) => d._count.child_departments > 0 || d._count.employee_profiles > 0,
    );

    if (blocked.length > 0) {
      throw new BadRequestException(
        `Cannot undo. Some departments created in this batch already have child departments or employees assigned.`,
      );
    }

    const deptIds = batch.departments.map((d) => d.id);
    let deletedCount = 0;
    if (deptIds.length > 0) {
      await this.prisma.assigneeCrossDeptBridge.deleteMany({
        where: { organization_id: orgId, OR: [{ from_department_id: { in: deptIds } }, { to_department_id: { in: deptIds } }] },
      });

      const { count } = await this.prisma.department.deleteMany({
        where: { id: { in: deptIds }, organization_id: orgId },
      });
      deletedCount = count;
    }

    await this.prisma.departmentImportBatch.update({
      where: { id: batchId },
      data: {
        status: 'undone',
        undone_at: new Date(),
        undo_summary: { undone: deletedCount, kept: [] } as any,
      },
    });

    this.assigneeVisibility.invalidate(orgId);

    return {
      batch_id: batchId,
      undone: deletedCount,
      kept: 0,
      status: 'undone',
    };
  }
}
