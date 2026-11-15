import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProcessAccessKind, ProcessAccessLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Principal } from '../access-rights/permissions.service';
import { ProcessAccessService } from './process-access.service';
import { AddAccessRuleDto } from './dto/access.dto';
import { requireProcessNode } from './process-helpers';

@Injectable()
export class ProcessAccessRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProcessAccessService,
  ) {}

  // ─── Access / sharing ─────────────────────────────────────────────────────────

  async listNodeAccess(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
  ) {
    await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId); // managing sharing is an edit concern
    const rules = await this.prisma.processNodeAccess.findMany({
      where: { organization_id: orgId, node_id: nodeId },
    });
    return this.enrichAccessRules(orgId, rules);
  }

  async addAccessRule(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    dto: AddAccessRuleDto,
  ) {
    await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    this.validateAccessDto(dto);
    const rule = await this.prisma.processNodeAccess.create({
      data: {
        organization_id: orgId,
        node_id: nodeId,
        kind: dto.kind,
        level:
          dto.kind === ProcessAccessKind.exclude_user
            ? ProcessAccessLevel.view
            : (dto.level ?? ProcessAccessLevel.view),
        department_id:
          dto.kind === ProcessAccessKind.department
            ? (dto.department_id ?? null)
            : null,
        include_sub_departments: dto.include_sub_departments ?? true,
        role_id:
          dto.kind === ProcessAccessKind.role ? (dto.role_id ?? null) : null,
        user_id:
          dto.kind === ProcessAccessKind.user ||
          dto.kind === ProcessAccessKind.exclude_user
            ? (dto.user_id ?? null)
            : null,
        created_by_user_id: principal.userId,
      },
    });
    return (await this.enrichAccessRules(orgId, [rule]))[0];
  }

  async removeAccessRule(
    orgId: string,
    principal: Principal,
    mapId: string,
    nodeId: string,
    ruleId: string,
  ) {
    await requireProcessNode(this.prisma, orgId, mapId, nodeId);
    await this.access.assertCanEditNode(orgId, principal, nodeId);
    const res = await this.prisma.processNodeAccess.deleteMany({
      where: { id: ruleId, node_id: nodeId, organization_id: orgId },
    });
    if (res.count === 0) throw new NotFoundException('Access rule not found');
    return { success: true };
  }

  private validateAccessDto(dto: AddAccessRuleDto) {
    if (dto.kind === ProcessAccessKind.department && !dto.department_id) {
      throw new BadRequestException(
        'department_id is required for a department attachment',
      );
    }
    if (dto.kind === ProcessAccessKind.role && !dto.role_id) {
      throw new BadRequestException(
        'role_id is required for a role attachment',
      );
    }
    if (
      (dto.kind === ProcessAccessKind.user ||
        dto.kind === ProcessAccessKind.exclude_user) &&
      !dto.user_id
    ) {
      throw new BadRequestException(
        'user_id is required for a person attachment',
      );
    }
  }

  /** Attach human-readable labels (dept name / role title / person name) for the UI. */
  async enrichAccessRules(orgId: string, rules: any[]) {
    if (rules.length === 0) return [];
    const deptIds = rules
      .map((r) => r.department_id)
      .filter(Boolean) as string[];
    const roleIds = rules.map((r) => r.role_id).filter(Boolean) as string[];
    const userIds = rules.map((r) => r.user_id).filter(Boolean) as string[];
    const [depts, roles, users] = await Promise.all([
      deptIds.length
        ? this.prisma.department.findMany({
            where: { id: { in: deptIds } },
            select: { id: true, name: true },
          })
        : [],
      roleIds.length
        ? this.prisma.role.findMany({
            where: { id: { in: roleIds } },
            select: { id: true, title: true },
          })
        : [],
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    const roleName = new Map(roles.map((r) => [r.id, r.title]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return rules.map((r) => ({
      ...r,
      label:
        r.kind === 'department'
          ? (deptName.get(r.department_id) ?? 'Department')
          : r.kind === 'role'
            ? (roleName.get(r.role_id) ?? 'Role')
            : (userName.get(r.user_id) ?? 'Person'),
    }));
  }
}
