import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssigneeVisibilityService } from '../assignee-visibility/assignee-visibility.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assigneeVisibility: AssigneeVisibilityService,
  ) {}

  async findAll(orgId: string, departmentId?: string) {
    return this.prisma.role.findMany({
      where: {
        organization_id: orgId,
        ...(departmentId ? { department_id: departmentId } : {}),
      },
      include: {
        department: {
          select: { id: true, name: true },
        },
        _count: {
          select: { employee_profiles: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(id: string, orgId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, organization_id: orgId },
      include: {
        department: {
          select: { id: true, name: true },
        },
        _count: {
          select: { employee_profiles: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found in this organization');
    }

    return role;
  }

  async create(orgId: string, dto: CreateRoleDto) {
    const department = await this.prisma.department.findFirst({
      where: { id: dto.department_id, organization_id: orgId },
    });

    if (!department) {
      throw new NotFoundException(
        'Department not found in this organization',
      );
    }

    const titleTrimmed = dto.title.trim();
    const existingTitle = await this.prisma.role.findFirst({
      where: {
        organization_id: orgId,
        department_id: dto.department_id,
        title: {
          equals: titleTrimmed,
          mode: 'insensitive',
        },
      },
    });

    if (existingTitle) {
      throw new BadRequestException(
        `A job role with the title "${dto.title}" already exists in this department (${department.name}).`,
      );
    }

    if (dto.level === 'head') {
      const existingHead = await this.prisma.role.findFirst({
        where: {
          organization_id: orgId,
          department_id: dto.department_id,
          level: 'head',
        },
      });
      if (existingHead) {
        throw new BadRequestException(
          `A role with head level already exists in this department (${department.name}).`,
        );
      }
    }

    const created = await this.prisma.role.create({
      data: {
        ...dto,
        organization_id: orgId,
        kra: (dto.kra ?? []) as any,
        kpi: (dto.kpi ?? []) as any,
      } as any,
      include: {
        department: {
          select: { id: true, name: true },
        },
      },
    });
    this.assigneeVisibility.invalidate(orgId);
    return created;
  }

  async update(id: string, orgId: string, dto: UpdateRoleDto) {
    const existing = await this.findOne(id, orgId);

    if (dto.department_id) {
      const department = await this.prisma.department.findFirst({
        where: { id: dto.department_id, organization_id: orgId },
      });

      if (!department) {
        throw new NotFoundException(
          'Department not found in this organization',
        );
      }
    }

    const targetDeptId = dto.department_id ?? existing.department_id;
    const targetLevel = dto.level ?? existing.level;
    const targetTitle = dto.title ? dto.title.trim() : existing.title;

    if (dto.title || dto.department_id) {
      const existingTitle = await this.prisma.role.findFirst({
        where: {
          organization_id: orgId,
          department_id: targetDeptId,
          title: {
            equals: targetTitle,
            mode: 'insensitive',
          },
          id: { not: id },
        },
      });

      if (existingTitle) {
        const dept = dto.department_id
          ? await this.prisma.department.findUnique({ where: { id: dto.department_id } })
          : existing.department;
        throw new BadRequestException(
          `A job role with the title "${targetTitle}" already exists in this department (${dept?.name}).`,
        );
      }
    }

    if (targetLevel === 'head') {
      const existingHead = await this.prisma.role.findFirst({
        where: {
          organization_id: orgId,
          department_id: targetDeptId,
          level: 'head',
          id: { not: id },
        },
      });
      if (existingHead) {
        const dept = dto.department_id
          ? await this.prisma.department.findUnique({ where: { id: dto.department_id } })
          : existing.department;
        throw new BadRequestException(
          `A role with head level already exists in this department (${dept?.name}).`,
        );
      }
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: dto as any,
      include: {
        department: {
          select: { id: true, name: true },
        },
      },
    });
    // Role level / department changes affect bridge "senior" slices and excludes.
    this.assigneeVisibility.invalidate(orgId);
    return updated;
  }

  async remove(id: string, orgId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, organization_id: orgId },
      include: {
        _count: { select: { employee_profiles: true } },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found in this organization');
    }

    if (role._count.employee_profiles > 0) {
      throw new BadRequestException(
        'Cannot delete role that has employees assigned. Reassign employees first.',
      );
    }

    await this.prisma.role.delete({ where: { id } });

    this.assigneeVisibility.invalidate(orgId);
    return { message: 'Role deleted successfully' };
  }

  async listImportBatches(orgId: string) {
    const batches = await this.prisma.roleImportBatch.findMany({
      where: { organization_id: orgId },
      include: {
        imported_by: {
          select: { name: true },
        },
        roles: {
          select: {
            id: true,
            _count: {
              select: {
                employee_profiles: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return batches.map((b) => {
      const hasDependents = b.roles.some((r) => r._count.employee_profiles > 0);
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
        remaining: b.status === 'committed' ? b.roles.length : 0,
        can_undo: b.status === 'committed' && !hasDependents,
      };
    });
  }

  async createImportBatch(
    orgId: string,
    userId: string,
    dto: { file_name?: string; total_rows: number; created_count: number; failed_count: number; role_ids: string[] },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.roleImportBatch.create({
        data: {
          organization_id: orgId,
          imported_by_user_id: userId,
          file_name: dto.file_name ?? null,
          total_rows: dto.total_rows,
          created_count: dto.created_count,
          failed_count: dto.failed_count,
        },
      });

      if (dto.role_ids.length > 0) {
        await tx.role.updateMany({
          where: { id: { in: dto.role_ids }, organization_id: orgId },
          data: { import_batch_id: batch.id },
        });
      }

      return batch;
    });
  }

  async undoImport(orgId: string, batchId: string) {
    const batch = await this.prisma.roleImportBatch.findFirst({
      where: { id: batchId, organization_id: orgId },
      include: {
        roles: {
          include: {
            _count: {
              select: {
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

    const blocked = batch.roles.filter((r) => r._count.employee_profiles > 0);

    if (blocked.length > 0) {
      throw new BadRequestException(
        `Cannot undo. Some job roles created in this batch already have employees assigned to them.`,
      );
    }

    const roleIds = batch.roles.map((r) => r.id);
    let deletedCount = 0;
    if (roleIds.length > 0) {
      const { count } = await this.prisma.role.deleteMany({
        where: { id: { in: roleIds }, organization_id: orgId },
      });
      deletedCount = count;
    }

    await this.prisma.roleImportBatch.update({
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
